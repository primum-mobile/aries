import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      data-aries-control-appearance="local"
      className={cn(
        "flex field-sizing-content min-h-[var(--aries-control-textarea-min-height)] w-full rounded-[var(--aries-radius-ui-control)] border border-input bg-transparent px-[var(--aries-control-padding-x)] py-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-control)] transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
