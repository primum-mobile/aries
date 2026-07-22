"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

type SheetSize = "sidebar" | "sm" | "md" | "lg"

const SHEET_SIZE_CLASS: Record<SheetSize, string> = {
  sidebar: "w-[min(var(--aries-sheet-width-sidebar),var(--aries-sheet-viewport-width-sidebar))]",
  sm: "w-[min(var(--aries-sheet-width-sm),calc(100vw-var(--aries-sheet-viewport-inset-sm)))]",
  md: "w-[min(var(--aries-sheet-width-md),calc(100vw-var(--aries-sheet-viewport-inset-md)))] sm:w-[min(var(--aries-sheet-width-sidebar),calc(100vw-var(--aries-sheet-viewport-inset-md)))]",
  lg: "w-[min(var(--aries-sheet-width-lg),var(--aries-sheet-viewport-width-lg))]",
}

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-[color:var(--aries-overlay-scrim)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  size = "sidebar",
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  size?: SheetSize
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex max-w-none flex-col gap-[var(--aries-sheet-content-gap)] bg-popover bg-clip-padding text-[length:var(--aries-font-size-control)] text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:w-full data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[var(--aries-sheet-motion-distance)] data-[side=bottom]:data-starting-style:translate-y-[var(--aries-sheet-motion-distance)] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:border-r data-[side=left]:data-ending-style:-translate-x-[var(--aries-sheet-motion-distance)] data-[side=left]:data-starting-style:-translate-x-[var(--aries-sheet-motion-distance)] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[var(--aries-sheet-motion-distance)] data-[side=right]:data-starting-style:translate-x-[var(--aries-sheet-motion-distance)] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:w-full data-[side=top]:border-b data-[side=top]:data-ending-style:-translate-y-[var(--aries-sheet-motion-distance)] data-[side=top]:data-starting-style:-translate-y-[var(--aries-sheet-motion-distance)]",
          (side === "left" || side === "right") && SHEET_SIZE_CLASS[size],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute right-[var(--aries-sheet-close-inset)] top-[var(--aries-sheet-close-inset)]"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-[var(--aries-sheet-header-gap)] p-[var(--aries-sheet-padding)]", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-[var(--aries-sheet-footer-gap)] p-[var(--aries-sheet-padding)]", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-[length:var(--aries-font-size-dialog-title)] font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-[length:var(--aries-font-size-control)] text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
