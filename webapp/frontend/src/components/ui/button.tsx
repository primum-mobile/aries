import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--aries-radius-ui-control)] border border-transparent bg-clip-padding text-[length:var(--aries-font-size-control)] font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size-default)]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[var(--aries-control-height)] gap-[var(--aries-control-gap)] px-[var(--aries-control-padding-x)] has-data-[icon=inline-end]:pr-[var(--aries-control-icon-padding-x)] has-data-[icon=inline-start]:pl-[var(--aries-control-icon-padding-x)]",
        xs: "h-[var(--aries-control-height-compact)] gap-[var(--aries-control-gap-compact)] rounded-[var(--aries-radius-ui-control-compact)] px-[var(--aries-control-padding-x-compact)] text-xs in-data-[slot=button-group]:rounded-[var(--aries-radius-ui-control)] has-data-[icon=inline-end]:pr-[var(--aries-control-icon-padding-x-compact)] has-data-[icon=inline-start]:pl-[var(--aries-control-icon-padding-x-compact)] [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size-xs)]",
        sm: "h-[var(--aries-control-height-small)] gap-[var(--aries-control-gap-compact)] rounded-[var(--aries-radius-ui-control-compact)] px-[var(--aries-control-padding-x)] text-[0.8rem] in-data-[slot=button-group]:rounded-[var(--aries-radius-ui-control)] has-data-[icon=inline-end]:pr-[var(--aries-control-icon-padding-x-compact)] has-data-[icon=inline-start]:pl-[var(--aries-control-icon-padding-x-compact)] [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size)]",
        lg: "h-[var(--aries-control-height-large)] gap-[var(--aries-control-gap)] px-[var(--aries-control-padding-x)] has-data-[icon=inline-end]:pr-[var(--aries-control-icon-padding-x)] has-data-[icon=inline-start]:pl-[var(--aries-control-icon-padding-x)]",
        icon: "size-[var(--aries-control-height)]",
        "icon-xs":
          "size-[var(--aries-control-height-compact)] rounded-[var(--aries-radius-ui-control-compact)] in-data-[slot=button-group]:rounded-[var(--aries-radius-ui-control)] [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size-xs)]",
        "icon-sm":
          "size-[var(--aries-control-height-small)] rounded-[var(--aries-radius-ui-control-compact)] in-data-[slot=button-group]:rounded-[var(--aries-radius-ui-control)]",
        "icon-lg": "size-[var(--aries-control-height-large)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
