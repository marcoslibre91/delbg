export default function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "dev";
  return (
    <div className="version-badge" title={`Commit ${sha}`}>
      v{version} · {sha}
    </div>
  );
}
