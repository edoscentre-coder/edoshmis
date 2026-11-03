"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/primitives";

const SKIP = new Set(["of", "the", "and", "&", "for", "at", "in", "de", "la"]);

/**
 * A short code from a name: the initials of its words ("Mfano Main
 * Hospital" → "MMH"), or the first letters of a one-word name ("Kijabe" →
 * "KIJ"). Letters and digits only, 2–8 characters, as the database requires.
 */
export function codeFrom(name: string) {
  const words = name
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SKIP.has(w.toLowerCase()));
  let code = words.length >= 2 ? words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join("") : (words[0] ?? "").slice(0, 3);
  code = code.toUpperCase().slice(0, 8);
  return code.length >= 2 ? code : "";
}

/**
 * Name and code side by side. The code follows the name until someone types
 * in it; after that it is theirs. Clearing it hands it back to the name.
 */
export function NameAndCode({
  nameField = "name",
  codeField = "code",
  nameLabel,
  codeLabel = "Code",
  codeHint = "2–8 letters or digits",
  defaultName = "",
  defaultCode = "",
  placeholder,
}: {
  nameField?: string;
  codeField?: string;
  nameLabel: string;
  codeLabel?: string;
  codeHint?: string;
  defaultName?: string;
  defaultCode?: string;
  placeholder?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState(defaultCode);
  const [touched, setTouched] = useState(Boolean(defaultCode));
  const shown = touched ? code : codeFrom(name);

  return (
    <div className="grid grid-cols-[1fr_104px] gap-3">
      <Field label={nameLabel} required>
        <Input name={nameField} required value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} autoCapitalize="words" />
      </Field>
      <Field label={codeLabel} required hint={touched ? codeHint : "From the name — edit if you like"}>
        <Input
          name={codeField}
          required
          value={shown}
          onChange={(e) => {
            const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
            setTouched(v !== "");
            setCode(v);
          }}
          pattern="[A-Z0-9]{2,8}"
          className="tnum uppercase"
          autoComplete="off"
        />
      </Field>
    </div>
  );
}
