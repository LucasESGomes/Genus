import { EmployeeMirrorScreen } from '@/features/timesheets/EmployeeMirrorScreen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeMirrorScreen rawId={id} />;
}
