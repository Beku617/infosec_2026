import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class BootstrapAdminDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must include uppercase, lowercase, and number'
  })
  password!: string;
}
