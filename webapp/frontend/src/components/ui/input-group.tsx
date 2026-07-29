"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex h-[var(--aries-control-height)] w-full min-w-0 items-center rounded-[var(--aries-radius-ui-control)] border border-input transition-colors outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:bg-input/50 has-disabled:opacity-50 has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto dark:bg-input/30 dark:has-disabled:bg-input/80 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 has-[>[data-align=block-end]]:[&>input]:pt-[var(--aries-form-row-gap)] has-[>[data-align=block-start]]:[&>input]:pb-[var(--aries-form-row-gap)] has-[>[data-align=inline-end]]:[&>input]:pr-[var(--aries-control-gap)] has-[>[data-align=inline-start]]:[&>input]:pl-[var(--aries-control-gap)]",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-[var(--aries-form-field-gap)] py-[var(--aries-control-gap)] text-[length:var(--aries-font-size-control)] font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[var(--aries-radius-control-compact)] [&>svg:not([class*='size-'])]:size-[var(--aries-control-icon-size-default)]",
  {
    variants: {
      align: {
        "inline-start":
          "order-first pl-[var(--aries-control-padding-x-compact)] has-[>button]:ml-[calc(-1*var(--aries-control-gap-compact))] has-[>kbd]:ml-[calc(-1*var(--aries-segmented-control-padding))]",
        "inline-end":
          "order-last pr-[var(--aries-control-padding-x-compact)] has-[>button]:mr-[calc(-1*var(--aries-control-gap-compact))] has-[>kbd]:mr-[calc(-1*var(--aries-segmented-control-padding))]",
        "block-start":
          "order-first w-full justify-start px-[var(--aries-control-padding-x)] pt-[var(--aries-form-field-gap)] group-has-[>input]/input-group:pt-[var(--aries-form-field-gap)] [.border-b]:pb-[var(--aries-form-field-gap)]",
        "block-end":
          "order-last w-full justify-start px-[var(--aries-control-padding-x)] pb-[var(--aries-form-field-gap)] group-has-[>input]/input-group:pb-[var(--aries-form-field-gap)] [.border-t]:pt-[var(--aries-form-field-gap)]",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-control)] shadow-none",
  {
    variants: {
      size: {
        xs: "h-[var(--aries-control-height-compact)] gap-[var(--aries-control-gap-compact)] rounded-[var(--aries-radius-sm)] px-[var(--aries-control-gap)] [&>svg:not([class*='size-'])]:size-[var(--aries-control-icon-size)]",
        sm: "",
        "icon-xs":
          "size-[var(--aries-control-height-compact)] rounded-[var(--aries-radius-sm)] p-0 has-[>svg]:p-0",
        "icon-sm": "size-[var(--aries-control-height)] p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-control)] text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[var(--aries-control-icon-size-default)]",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-[var(--aries-form-field-gap)] shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
