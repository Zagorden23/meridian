import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 active:not-disabled:scale-[0.96]", {
    variants: {
        variant: {
            primary: "bg-fg text-bg shadow-border hover:opacity-90",
            ghost: "bg-transparent text-fg shadow-border hover:bg-surface-raised/80",
            quiet: "bg-transparent text-muted hover:text-fg",
        },
        size: {
            md: "h-11 px-4",
            sm: "h-10 px-3",
        },
    },
    defaultVariants: {
        variant: "primary",
        size: "md",
    },
});
export function Button({ className, variant, size, asChild = false, ...props }) {
    const Comp = asChild ? Slot : "button";
    return (<Comp className={cn(buttonVariants({ variant, size }), className)} {...props}/>);
}
