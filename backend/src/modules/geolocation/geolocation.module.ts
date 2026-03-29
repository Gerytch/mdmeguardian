import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Location } from './entities/location.entity';
import { Device } from '../devices/entities/device.entity';
import { GeolocationService } from './geolocation.service';
import { GeolocationController } from './geolocation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Location, Device])],
  controllers: [GeolocationController],
  providers: [GeolocationService],
  exports: [GeolocationService],
})
export class GeolocationModule {}
