import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

import { UserRole } from '../../users/user.schema';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(['professor', 'student'])
  role!: UserRole;
}
