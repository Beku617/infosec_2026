import { UserRole } from '../../users/user.schema';

export interface JwtUser {
  sub: string;
  username: string;
  role: UserRole;
  type: 'access' | 'refresh';
}
