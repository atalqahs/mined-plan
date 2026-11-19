import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/design-system/typography/fonts.css';
import '@/design-system/tokens/tokens.css';
import '@/design-system/typography/base.css';
import { createContainer } from '@/app/bootstrap/container';
import { buildBenchSnapshot } from '@/app/bootstrap/sampleData';
import { App } from '@/app/App';
import { installDebugApi } from '@/app/bootstrap/debugApi';
import { installDesktopIntegration } from '@/presentation/desktop/desktopIntegration';

async function bootstrap() {
  const params = new URLSearchParams(location.search);
  const bench = Number(params.get('bench') ?? 0);
  // ?bench=N runs against a throwaway in-memory store so measurements never touch user data.
  const container = await createContainer({ ephemeral: bench > 0 });
  if (bench > 0) container.store.hydrateEphemeral(buildBenchSnapshot(Math.min(5000, bench)));
  installDebugApi(container);
  const root = document.getElementById('root')!;
  root.removeAttribute('aria-busy');
  createRoot(root).render(
    <StrictMode>
      <App container={container} />
    </StrictMode>,
  );
  await installDesktopIntegration(container); // Windows desktop build only
}

bootstrap().catch((e) => {
  console.error(e);
  const root = document.getElementById('root');
  if (root) root.textContent = 'تعذّر تشغيل التطبيق. أعد تحميل الصفحة، وإن تكرر الخطأ فجرّب متصفحًا آخر.';
});
