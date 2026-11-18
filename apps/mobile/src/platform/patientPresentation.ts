export function maskAccountEmail(email: string): string {
  const match = /^([^@])[^@]*@([^@]+)$/.exec(email.trim());
  return match ? `${match[1]}***@${match[2]}` : "Signed-in account";
}

export function homePresentation(syntheticPreview: boolean, confirmedCount: number): { title: string; subtitle: string } {
  if (syntheticPreview) return { title: "Good morning, Mira", subtitle: "Your synthetic demo record is ready." };
  return {
    title: "Your health record",
    subtitle: confirmedCount === 0
      ? "Your encrypted vault is empty. Add your first reviewed record."
      : `${confirmedCount} confirmed ${confirmedCount === 1 ? "fact is" : "facts are"} available in this encrypted vault.`
  };
}
