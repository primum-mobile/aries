"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { useDraggableOverlay } from "@/hooks/use-draggable-overlay"
import { useT } from "@/lib/i18n/i18n"

type DialogMotion = "default" | "none"
type DialogSize =
  | "compact"
  | "xs"
  | "sm"
  | "md"
  | "detail"
  | "prose"
  | "reading"
  | "lg"
  | "workspace"
  | "wide"
  | "xl"

const DIALOG_SIZE_CLASS: Record<DialogSize, string> = {
  compact: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-compact))] sm:w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-sm))]",
  xs: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-xs))]",
  sm: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-sm))]",
  md: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-md))] sm:w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-sm))]",
  detail: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-detail))] sm:w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-sm))]",
  prose: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-prose))] sm:w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-sm))]",
  reading: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-reading))] sm:w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-sm))]",
  lg: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-lg))]",
  workspace: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-workspace))]",
  wide: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-wide))]",
  xl: "w-[min(var(--aries-dialog-viewport-width),calc(100vw-var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-xl))]",
}

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  motion = "default",
  ...props
}: DialogPrimitive.Backdrop.Props & {
  motion?: DialogMotion
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-[color:var(--aries-overlay-scrim)] supports-backdrop-filter:backdrop-blur-xs",
        motion === "default" &&
          "duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

type DialogContentProps = DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  motion?: DialogMotion
  size?: DialogSize
}

function DialogContent(props: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay motion={props.motion} />
      <DialogPopup {...props} />
    </DialogPortal>
  )
}

function isOutsideDragHeader(target: EventTarget | null) {
  return !(target instanceof Element)
    || !target.closest('[data-slot="dialog-header"]')?.parentElement?.hasAttribute("data-floating-dialog")
    || Boolean(target.closest('button, input, textarea, select, a, [role="button"]'))
}

/** A modeless, retained tool panel. The portal frame never intercepts the app. */
function FloatingDialogContent(props: DialogContentProps) {
  return (
    <DialogPortal keepMounted>
      <FloatingDialogPopup {...props} />
    </DialogPortal>
  )
}

/** The same popup contents hosted in an undecorated native tool window. */
function NativeDialogContent({ className, ...props }: DialogContentProps) {
  return (
    <DialogPortal keepMounted>
      <DialogPopup {...props} motion="none" data-native-settings=""
        className={cn("inset-0 top-0 left-0 h-dvh w-full max-h-none translate-none rounded-none", className)} />
    </DialogPortal>
  )
}

function FloatingDialogPopup({ className, ...props }: DialogContentProps) {
  const {
    overlayRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleLostPointerCapture,
    handleDoubleClick,
  } = useDraggableOverlay({ isBlockedTarget: isOutsideDragHeader })
  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <DialogPopup
        {...props}
        data-floating-dialog=""
        ref={overlayRef}
        motion="none"
        className={cn("pointer-events-auto translate-none [transform:translate(-50%,-50%)] [&_[data-slot=dialog-header]]:cursor-grab [&_[data-slot=dialog-header]]:touch-none [&_[data-slot=dialog-header]]:select-none", className)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  )
}

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  motion = "default",
  size = "sm",
  ...props
}: DialogContentProps) {
  const t = useT()
  return (
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-aries-surface="overlay"
        // Tool/dialog lifecycle must not select an arbitrary chrome action.
        // Explicit field focus (search, editor name, etc.) remains with callers.
        initialFocus={false}
        finalFocus={false}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-w-none -translate-x-1/2 -translate-y-1/2 gap-[var(--aries-dialog-gap)] rounded-[var(--aries-radius-dialog)] bg-[var(--aries-overlay-background)] p-[var(--aries-dialog-padding)] text-[length:var(--aries-font-size-control)] text-[color:var(--aries-overlay-text)] ring-1 ring-foreground/10 outline-none",
          DIALOG_SIZE_CLASS[size],
          motion === "default" &&
            "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-[var(--aries-dialog-close-inset)] right-[var(--aries-dialog-close-inset)]"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">{t("settings.close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-[var(--aries-dialog-header-gap)]", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-[var(--aries-dialog-padding)] -mb-[var(--aries-dialog-padding)] flex flex-col-reverse gap-[var(--aries-dialog-footer-gap)] rounded-b-[var(--aries-radius-dialog)] border-t bg-muted/50 p-[var(--aries-dialog-padding)] sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-[length:var(--aries-font-size-dialog-title)] leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[length:var(--aries-font-size-control)] text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  FloatingDialogContent,
  NativeDialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
