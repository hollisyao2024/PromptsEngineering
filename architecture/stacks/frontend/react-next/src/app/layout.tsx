import type { ReactNode } from 'react';
import '../styles.css';
export default function Layout({ children }: { children: ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
