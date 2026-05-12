import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTranscriptDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsOptional()
  @IsBoolean()
  allowStudentAccess?: boolean;
}
