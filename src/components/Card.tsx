import type { ReactNode, ElementType } from "react";

interface CardProps {

  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  icon?: ElementType;
  action?: ReactNode;
}

export function Card({ children, className = "", title, subtitle, icon: Icon, action }: CardProps) {
  return (
    <section
      className={`rounded-panel border border-border bg-panel shadow-panel ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={14} className="text-zinc-500" strokeWidth={2} />}
            <div>
              {title && <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>}
              {subtitle && <p className="text-2xs text-zinc-600">{subtitle}</p>}
            </div>
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
