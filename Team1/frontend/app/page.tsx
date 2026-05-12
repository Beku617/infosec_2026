import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default function HomePage() {
  const hasAccessToken = cookies().has('accessToken');
  redirect(hasAccessToken ? '/dashboard' : '/login');
}
