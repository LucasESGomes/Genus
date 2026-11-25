import { DeviceDetailScreen } from '@/features/totems/DeviceDetailScreen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeviceDetailScreen rawId={id} />;
}
