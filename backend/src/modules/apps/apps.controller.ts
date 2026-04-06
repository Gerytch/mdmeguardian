import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as unzipper from 'unzipper';
import { AppsService, CreateAppDto, UpdateAppDto } from './apps.service';
import { App } from './entities/app.entity';

const execAsync = promisify(exec);

interface ApkMeta {
  packageName?: string;
  versionName?: string;
  appLabel?: string;
}

function findAapt2(): string | null {
  const gradleCache = join(process.env['USERPROFILE'] || process.env['HOME'] || '', '.gradle', 'caches');
  try {
    // Search up to 2 levels deep inside gradle transforms cache
    const topDirs = ['8.11.1', '9.3.1', '9.0.0', '8.9.0'];
    for (const ver of topDirs) {
      const transformsPath = join(gradleCache, ver, 'transforms');
      try {
        const entries = readdirSync(transformsPath);
        for (const entry of entries) {
          const nested = join(transformsPath, entry, 'transformed');
          try {
            const contents = readdirSync(nested);
            for (const item of contents) {
              if (item.startsWith('aapt2-') && item.includes('windows')) {
                const candidate = join(nested, item, 'aapt2.exe');
                return candidate;
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

async function extractBaseApkFromXapk(xapkPath: string): Promise<string> {
  const tempPath = xapkPath + '.base.apk';
  const directory = await unzipper.Open.file(xapkPath);
  const baseApk = directory.files.find(
    (f) => f.path === 'base.apk' || (f.path.endsWith('.apk') && !f.path.includes('/')),
  );
  if (!baseApk) throw new Error('base.apk not found inside XAPK');
  await new Promise<void>((resolve, reject) => {
    baseApk.stream().pipe(require('fs').createWriteStream(tempPath))
      .on('finish', resolve)
      .on('error', reject);
  });
  return tempPath;
}

async function extractApkMeta(apkPath: string): Promise<ApkMeta> {
  const aapt2 = findAapt2();
  if (!aapt2) return {};

  let pathToAnalyze = apkPath;
  let tempFile: string | null = null;

  if (apkPath.endsWith('.xapk')) {
    try {
      tempFile = await extractBaseApkFromXapk(apkPath);
      pathToAnalyze = tempFile;
    } catch {
      return {};
    }
  }

  try {
    const { stdout } = await execAsync(`"${aapt2}" dump badging "${pathToAnalyze}"`, { timeout: 10_000 });
    const packageMatch = stdout.match(/package: name='([^']+)'/);
    const versionMatch = stdout.match(/versionName='([^']+)'/);
    const labelMatch =
      stdout.match(/application-label-pt(?:-BR)?:'([^']+)'/) ||
      stdout.match(/application-label:'([^']+)'/);
    return {
      packageName: packageMatch?.[1],
      versionName: versionMatch?.[1],
      appLabel: labelMatch?.[1],
    };
  } catch {
    return {};
  } finally {
    if (tempFile) try { unlinkSync(tempFile); } catch { /* ignore */ }
  }
}

@Controller('tenants/:tenantId/apps')
export class AppsController {
  private readonly logger = new Logger(AppsController.name);

  constructor(private readonly appsService: AppsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const base = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
          const dir = join(base, 'apks');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const ext = extname(file.originalname) || '.apk';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        const isAllowed =
          file.mimetype === 'application/vnd.android.package-archive' ||
          ext === '.apk' ||
          ext === '.xapk';
        isAllowed
          ? cb(null, true)
          : cb(new BadRequestException('Apenas arquivos APK ou XAPK são permitidos'), false);
      },
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  async uploadApk(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ apkUrl: string; originalName: string; sizeBytes: number } & ApkMeta> {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    const meta = await extractApkMeta(file.path);
    this.logger.log(`APK uploaded: ${file.filename} — pkg=${meta.packageName} ver=${meta.versionName}`);
    return {
      apkUrl: `/uploads/apks/${file.filename}`,
      originalName: file.originalname,
      sizeBytes: file.size,
      ...meta,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateAppDto,
  ): Promise<App> {
    return this.appsService.create(tenantId, dto);
  }

  @Get()
  findAll(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<App[]> {
    return this.appsService.findAll(tenantId);
  }

  @Get('required')
  getRequired(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<App[]> {
    return this.appsService.getRequired(tenantId);
  }

  @Get(':id')
  findOne(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<App> {
    return this.appsService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppDto,
  ): Promise<App> {
    return this.appsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.appsService.remove(tenantId, id);
  }
}
