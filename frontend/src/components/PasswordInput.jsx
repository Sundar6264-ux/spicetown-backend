import { useState } from "react";

export default function PasswordInput({ value, onChange, placeholder, autoComplete, autoFocus, style }) {
  const [visible, setVisible] = useState(false);

  return (
    <div style={{ position: "relative", display: "flex", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        style={{ flex: 1, paddingRight: "2.6rem" }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          right: "0.35rem",
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: "none",
          padding: "0.15rem 0.35rem",
          cursor: "pointer",
          fontSize: "0.78rem",
          fontWeight: 600,
          color: "var(--accent)",
        }}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
