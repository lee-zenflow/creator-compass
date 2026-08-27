import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BottomNav, type ProductTabId } from "./bottom-nav";

type AppShellBaseProps = {
  title: string;
  coordinate?: string;
  rightAction?: ReactNode;
  backHref?: string;
  stickyFooter?: ReactNode;
  children: ReactNode;
};

export type AppShellProps = AppShellBaseProps &
  (
    | { bottomNav?: true; activeTab: ProductTabId }
    | { bottomNav: false; activeTab?: never }
  );

export function AppShell(props: AppShellProps) {
  const showBottomNav = props.bottomNav !== false;
  return (
    <div className="app-viewport">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div
        className="app-shell"
        data-bottom-nav={showBottomNav}
        data-sticky-footer={Boolean(props.stickyFooter)}
      >
        <header className="app-bar">
          <div className="app-bar__leading">
            {props.backHref ? (
              <Link className="app-bar__back" href={props.backHref} aria-label="返回">
                <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.6} />
              </Link>
            ) : null}
            {props.coordinate ? (
              <span
                aria-hidden="true"
                className="app-bar__coordinate"
                translate="no"
              >
                {props.coordinate}
              </span>
            ) : null}
          </div>
          <h1 className="app-bar__title">{props.title}</h1>
          <div className="app-bar__action">{props.rightAction}</div>
        </header>
        <main className="app-content" id="main-content" tabIndex={-1}>
          {props.children}
        </main>
        {props.stickyFooter ? (
          <footer className="app-sticky-footer">{props.stickyFooter}</footer>
        ) : null}
        {showBottomNav ? <BottomNav active={props.activeTab} /> : null}
      </div>
    </div>
  );
}
