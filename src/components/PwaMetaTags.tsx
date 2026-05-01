'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Conditionally manages PWA-related meta/link tags.
 *
 * - Main app (/, /performance/*, etc.) keeps the manifest so iOS installs
 *   it as a standalone PWA titled "BW5 App".
 * - Staff and admin pages (/staff/*, /admin/*) drop the manifest and instead
 *   inject `apple-mobile-web-app-title` + a custom `apple-touch-icon` so that
 *   "Add to Home Screen" creates a bookmark to the EXACT URL with a
 *   distinctive label and icon — not a redirect to "/".
 */

type RouteMeta = { title: string; icon: string };

function metaForPath(pathname: string): RouteMeta | null {
  if (pathname.startsWith('/staff/orders')) {
    return { title: 'BW5 物販スタッフ', icon: '/images/icon-staff-orders.png' };
  }
  if (pathname.startsWith('/staff/backstage')) {
    return { title: 'BW5 舞台裏', icon: '/images/icon-staff-backstage.png' };
  }
  if (pathname.startsWith('/admin')) {
    return { title: 'BW5 管理', icon: '/images/icon-admin.png' };
  }
  return null;
}

export default function PwaMetaTags() {
  const pathname = usePathname() ?? '/';
  const override = metaForPath(pathname);
  const isStandalone = !override; // main app is the only standalone PWA

  useEffect(() => {
    const head = document.head;
    const removeTag = (selector: string) => {
      head.querySelectorAll(selector).forEach((el) => el.remove());
    };
    const setMeta = (name: string, content: string) => {
      let el = head.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('name', name);
        head.appendChild(el);
      }
      el.setAttribute('content', content);
    };
    const setLink = (rel: string, href: string) => {
      let el = head.querySelector(`link[rel="${rel}"][data-pwa-dynamic="1"]`) as HTMLLinkElement | null;
      if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', rel);
        el.setAttribute('data-pwa-dynamic', '1');
        head.appendChild(el);
      }
      el.setAttribute('href', href);
    };

    if (isStandalone) {
      // Main app — restore manifest + standalone behavior
      removeTag('link[rel="apple-touch-icon"][data-pwa-dynamic="1"]');
      let manifest = head.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      if (!manifest) {
        manifest = document.createElement('link');
        manifest.rel = 'manifest';
        manifest.href = '/manifest.webmanifest';
        head.appendChild(manifest);
      }
      setMeta('apple-mobile-web-app-capable', 'yes');
      setMeta('mobile-web-app-capable', 'yes');
      setMeta('apple-mobile-web-app-title', 'BW5 App');
    } else {
      // Staff / admin — bookmark mode with custom title + icon
      removeTag('link[rel="manifest"]');
      setMeta('apple-mobile-web-app-capable', 'no');
      setMeta('mobile-web-app-capable', 'no');
      setMeta('apple-mobile-web-app-title', override!.title);
      setLink('apple-touch-icon', override!.icon);
      // Also override <title> so Android "Add to Home Screen" picks it up
      document.title = override!.title;
    }
  }, [pathname, isStandalone, override]);

  return null;
}
