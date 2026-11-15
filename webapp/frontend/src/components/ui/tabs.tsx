"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      // Base UI shares orientation with List/Tab through context; their own
      // data-orientation drives the vertical rail styles and arrow-key axis.
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-[var(--aries-tabs-gap)] data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-[var(--aries-tabs-list-corner-radius)] p-[var(--aries-tabs-list-padding)] text-muted-foreground data-horizontal:h-[var(--aries-tabs-height)] data-vertical:h-fit data-vertical:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-[var(--aries-tabs-line-gap)] bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-aries-surface={variant === "default" ? "control" : undefined}
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "aries-desktop-focus relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-[var(--aries-tabs-trigger-gap)] rounded-[var(--aries-tab-corner-radius)] border border-transparent px-[var(--aries-tabs-trigger-padding-x)] py-[var(--aries-tabs-trigger-padding-y)] text-[length:var(--aries-font-size-large)] font-medium whitespace-nowrap text-foreground/60 transition-all data-vertical:w-full data-vertical:justify-start hover:text-foreground disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-[var(--aries-control-gap-compact)] has-data-[icon=inline-start]:pl-[var(--aries-control-gap-compact)] aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size-default)]",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity data-horizontal:after:inset-x-0 data-horizontal:after:bottom-[calc(-1*var(--aries-tabs-indicator-offset))] data-horizontal:after:h-[var(--aries-tabs-indicator-size)] data-vertical:after:inset-y-0 data-vertical:after:-right-1 data-vertical:after:w-[var(--aries-tabs-indicator-size)] group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        "flex-1 text-[length:var(--aries-font-size-control)] outline-none",
        className,
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
