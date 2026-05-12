import { UserRole } from '../../users/user.schema';

export interface JwtUser {
  sub: string;
  role: UserRole;
}
