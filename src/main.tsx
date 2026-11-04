import { createRoot } from 'react-dom/client';
import { Editor } from './app/Editor';
import { loadDraft } from './files';
import { initializeTheme } from './app/theme';
initializeTheme();
const root = createRoot(document.getElementById('root')!);
loadDraft()
  .then((restored) => root.render(<Editor restored={restored} recoveryError={false} />))
  .catch(() => root.render(<Editor restored={null} recoveryError />));
