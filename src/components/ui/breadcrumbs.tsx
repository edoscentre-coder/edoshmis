import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Breadcrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="no-print mb-3 text-xs text-ink-faint">
      <ol className="flex flex-wrap items-center gap-1">
        {trail.map((t, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
            {t.href ? (
              <Link href={t.href} className="hover:text-ink">
                {t.label}
              </Link>
            ) : (
              <span className="text-ink-soft">{t.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
