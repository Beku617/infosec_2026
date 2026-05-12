import { IsEmail, IsIn, IsString, Matches, MinLength } from 'class-validator';

import { PUBLIC_REGISTER_ROLES } from './register.dto';

export class AdminCreateUserDto {
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

  @IsIn(PUBLIC_REGISTER_ROLES)
  role!: (typeof PUBLIC_REGISTER_ROLES)[number];
}
