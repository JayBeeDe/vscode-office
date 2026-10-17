export const code160to32 = (text: string) => {
    // convert non-breaking spaces to regular spaces
    return text.replace(/\u00a0/g, " ");
};
