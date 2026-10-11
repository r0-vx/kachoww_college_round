import { createRoot } from 'react-dom/client';
import { DemoLab } from './DemoLab';
import '../ui/global.css';
import '../ui/demo-focused.css';
import '../ui/reference-polish.css';

createRoot(document.getElementById('root')!).render(<DemoLab />);
