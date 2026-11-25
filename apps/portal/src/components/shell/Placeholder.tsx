/** Página ainda não implementada nesta rodada (substituída pelo lote dono da rota). */
import { Hammer } from '@phosphor-icons/react/dist/ssr';
import { EmptyState } from '@/components/ui/States';
import { PageHeader } from './PageHeader';

export function Placeholder({ title }: { title: string }) {
  return (
    <PageHeader title={title}>
      <EmptyState icon={Hammer} title="Em construção" text="Esta tela ainda está sendo montada." />
    </PageHeader>
  );
}
