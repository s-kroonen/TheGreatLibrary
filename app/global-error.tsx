"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <p>Something went wrong.</p>
          <button onClick={() => reset()}>Try again</button>
        </div>
      </body>
    </html>
  );
}
