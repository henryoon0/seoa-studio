// 네비게이션 한 곳. 서아님 스튜디오는 소통·회의 두 메뉴와 설정만 있다.

import type { IconName } from "@/components/icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/instagram-comments", label: "소통", icon: "chat" },
  { href: "/meetings", label: "회의", icon: "bell" },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "설정", icon: "settings" };

/** 경계를 지켜 /meetings 가 /meetings-x 를 활성화하지 않게 한다. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
