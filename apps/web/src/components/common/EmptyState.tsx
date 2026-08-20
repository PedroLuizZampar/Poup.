import React, { ReactNode, ComponentType, SVGProps } from "react";
import { Button } from "../ui/Button";

export interface EmptyStateProps {
  icon?: ComponentType<SVGProps<SVGSVGElement>> | ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  } | ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  const isIconComponent = typeof icon === "function";
  const IconComp = isIconComponent ? (icon as ComponentType<SVGProps<SVGSVGElement>>) : null;

  return (
    <div className={`py-12 px-6 flex flex-col items-center justify-center text-center max-w-sm mx-auto gap-3.5 ${className}`}>
      {icon && (
        <div className="w-14 h-14 rounded-card bg-surface-alt flex items-center justify-center text-primary shadow-sh1 border border-border">
          {IconComp ? <IconComp className="w-6 h-6" /> : (icon as React.ReactElement)}
        </div>
      )}
      <h3 className="font-display font-bold text-sm md:text-base text-text-primary">
        {title}
      </h3>
      <p className="text-xs text-text-secondary leading-relaxed">
        {description}
      </p>
      {action && (
        <div className="mt-2">
          {React.isValidElement(action) ? (
            action
          ) : typeof (action as any).onClick === "function" ? (
            <Button size="sm" onClick={(action as any).onClick}>
              {(action as any).label}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

