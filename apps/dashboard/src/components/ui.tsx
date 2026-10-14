import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ComponentProps, HTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-seal text-white hover:bg-seal/90",
        outline: "border border-line bg-paper-2 text-ink hover:bg-paper",
        ghost: "text-ink hover:bg-ink/5",
        destructive: "bg-bad text-white hover:bg-bad/90",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:border-seal",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:border-seal",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-sm font-medium text-ink", className)} {...props} />;
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "ok" | "warn" | "bad" | "seal" }) {
  const tones = {
    neutral: "bg-paper text-ink-soft border-line",
    ok: "bg-ok-soft text-ok border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
    bad: "bg-bad-soft text-bad border-transparent",
    seal: "bg-seal-soft text-seal border-transparent",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], className)}
      {...props}
    />
  );
}

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,44rem)] w-[min(100%-1.5rem,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-paper-2 p-5 shadow-xl",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("font-serif text-2xl font-medium tracking-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-1 text-sm text-ink-soft", className)} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Banner({ tone, children }: { tone: "warn" | "bad" | "ok"; children: ReactNode }) {
  const tones = {
    warn: "border-warn/30 bg-warn-soft text-warn",
    bad: "border-bad/30 bg-bad-soft text-bad",
    ok: "border-ok/30 bg-ok-soft text-ok",
  };
  return <div className={cn("rounded-md border px-3 py-2 text-sm", tones[tone])}>{children}</div>;
}
