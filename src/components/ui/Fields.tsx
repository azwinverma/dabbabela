import { cn } from "@/lib/utils";

type Base = { label?: string; hint?: string; error?: string; className?: string };

export function Field({ label, hint, error, className, children, htmlFor }: Base & { children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <label htmlFor={htmlFor} className="label">
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-mute">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-sindoor">{error}</p>}
    </div>
  );
}

export function Input({ label, hint, error, className, id, ...props }: Base & React.InputHTMLAttributes<HTMLInputElement>) {
  const fid = id ?? (props.name ? `f-${props.name}` : undefined);
  return (
    <Field label={label} hint={hint} error={error} className={className} htmlFor={fid}>
      <input id={fid} className={cn("field", error && "border-sindoor")} {...props} />
    </Field>
  );
}

export function Textarea({ label, hint, error, className, id, rows = 4, ...props }: Base & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fid = id ?? (props.name ? `f-${props.name}` : undefined);
  return (
    <Field label={label} hint={hint} error={error} className={className} htmlFor={fid}>
      <textarea id={fid} rows={rows} className={cn("field", error && "border-sindoor")} {...props} />
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  id,
  options,
  placeholder,
  ...props
}: Base & React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const fid = id ?? (props.name ? `f-${props.name}` : undefined);
  return (
    <Field label={label} hint={hint} error={error} className={className} htmlFor={fid}>
      <select id={fid} className={cn("field pr-8", error && "border-sindoor")} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({ label, hint, className, ...props }: { label: React.ReactNode; hint?: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-line accent-sindoor" {...props} />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-mute">{hint}</span>}
      </span>
    </label>
  );
}
