import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel';
import '../ui/global.css';
import '../ui/touchview-polish.css';
import '../ui/handfree-theme.css';

createRoot(document.getElementById('root')!).render(<SidePanel />);
