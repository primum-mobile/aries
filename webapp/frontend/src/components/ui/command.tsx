"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group"
import { SearchIcon, CheckIcon } from "lucide-react"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      data-aries-surface="popover"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-[var(--aries-radius-dialog)]! bg-popover p-[var(--aries-menu-padding)] text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-[var(--aries-spotlight-dialog-top)] translate-y-0 overflow-hidden rounded-[var(--aries-radius-dialog)]! p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  icon,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  icon?: React.ReactNode
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="p-[var(--aries-menu-padding)] pb-0"
    >
      <InputGroup className="h-[var(--aries-control-height)]! rounded-[var(--aries-radius-ui-control)]! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-[var(--aries-control-padding-x-compact)]!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full text-[length:var(--aries-font-size-control)] outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          {icon ?? (
            <SearchIcon className="size-[var(--aries-menu-icon-size)] shrink-0 opacity-50" />
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-[var(--aries-menu-command-max-height)] scroll-py-[var(--aries-menu-padding)] overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn(
        "py-[var(--aries-pane-state-padding)] text-center text-[length:var(--aries-font-size-control)]",
        className,
      )}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-[var(--aries-menu-padding)] text-foreground **:[[cmdk-group-heading]]:px-[var(--aries-menu-label-padding-x)] **:[[cmdk-group-heading]]:py-[var(--aries-menu-label-padding-y)] **:[[cmdk-group-heading]]:text-[length:var(--aries-font-size-small)] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn(
        "-mx-[var(--aries-menu-padding)] h-px bg-border",
        className,
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-[var(--aries-menu-item-gap)] rounded-[var(--aries-radius-menu-item)] px-[var(--aries-menu-item-padding-x)] py-[var(--aries-menu-item-padding-y)] text-[length:var(--aries-font-size-control)] outline-hidden select-none in-data-[slot=dialog-content]:rounded-[var(--aries-radius-menu-item)]! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-muted data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[var(--aries-menu-icon-size)] data-selected:*:[svg]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-[length:var(--aries-font-size-small)] text-muted-foreground group-data-selected/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
