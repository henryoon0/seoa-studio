"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { NAV_ITEMS, SETTINGS_ITEM, isNavItemActive } from "@/lib/nav";

// 데스크톱 사이드바. dashboard 의 Clobe 셸(cds-*)을 그대로 쓰고 메뉴만 줄였다.
export function Sidebar() {
  const pathname = usePathname();
  const settingsActive = isNavItemActive(pathname, SETTINGS_ITEM.href);

  return (
    <aside id="desktop-rail" className="cds-sidebar" aria-label="사이드바">
      <div className="cds-logo-row">
        <Link href="/" prefetch={false} className="cds-logo">
          심플리홈
        </Link>
        <Link
          href={SETTINGS_ITEM.href}
          prefetch={false}
          className="cds-icon-btn"
          aria-label="설정"
          aria-current={settingsActive ? "page" : undefined}
        >
          <Icon name="settings" size={20} />
        </Link>
      </div>

      <nav className="cds-iconnav" aria-label="메뉴">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className="cds-iconnav-item"
            aria-current={isNavItemActive(pathname, item.href) ? "page" : undefined}
          >
            <span className="ico">
              <Icon name={item.icon} size={22} />
            </span>
            <span className="lbl">{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
