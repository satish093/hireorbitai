import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface Crumb { label: string; to?: string }

export function Layout({
  title,
  crumbs,
  children,
}: {
  title: string;
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  // Use the location key so each route change retriggers the page-enter
  // animation. Without `key`, React reuses the same DOM node and the
  // animation only plays on the first mount.
  const loc = useLocation();
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} crumbs={crumbs} />
        <main key={loc.pathname} className="flex-1 p-8 overflow-auto animate-fade-in-up">
          {children}
        </main>
      </div>
    </div>
  );
}
