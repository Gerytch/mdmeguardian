import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string | string[];
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        error = this.codeForStatus(status);
      } else {
        const body = res as any;
        message = body.message ?? exception.message;
        error = body.error ?? this.codeForStatus(status);
      }
    } else if (exception instanceof QueryFailedError) {
      const pg = exception as any;
      if (pg.code === '23505') {
        status = HttpStatus.CONFLICT;
        error = 'DUPLICATE_ENTRY';
        message = 'A record with these details already exists.';
      } else if (pg.code === '23503') {
        status = HttpStatus.BAD_REQUEST;
        error = 'FOREIGN_KEY_VIOLATION';
        message = 'Referenced resource does not exist.';
      } else {
        status = HttpStatus.BAD_REQUEST;
        error = 'DATABASE_ERROR';
        message = 'A database error occurred.';
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      error = 'INTERNAL_SERVER_ERROR';
      message = 'An unexpected error occurred.';
      this.logger.error(`Unhandled: ${request.method} ${request.url}`, (exception as Error)?.stack);
    }

    if (status >= 500) {
      this.logger.error(`${status} ${request.method} ${request.url} — ${message}`);
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private codeForStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS', 500: 'INTERNAL_SERVER_ERROR',
    };
    return map[status] ?? 'ERROR';
  }
}
