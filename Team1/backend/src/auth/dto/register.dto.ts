import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export const PUBLIC_REGISTER_ROLES = ['professor', 'student'] as const;
export type PublicRegisterRole = (typeof PUBLIC_REGISTER_ROLES)[number];

export class RegisterDto {
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

  @IsOptional()
  @IsIn(PUBLIC_REGISTER_ROLES)
  role: PublicRegisterRole = 'student';
}
