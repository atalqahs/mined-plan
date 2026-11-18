import { AppProvider } from '@/app/providers/AppContext';
import type { AppContainer } from '@/app/bootstrap/container';
import { Workspace } from '@/presentation/ui/Workspace';

export function App({ container }: { container: AppContainer }) {
  return (
    <AppProvider container={container}>
      <Workspace />
    </AppProvider>
  );
}
