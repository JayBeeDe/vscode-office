export const addScript = (path: string, id: string) => {
    return new Promise<void>((resolve) => {
        if (document.getElementById(id)) {
            // once the script is loaded, later calls return immediately
            resolve();
            return false;
        }
        const scriptElement = document.createElement("script");
        scriptElement.src = path;
        scriptElement.async = true;
        // Chrome does not request the js again on repeated calls
        document.head.appendChild(scriptElement);
        scriptElement.onload = () => {
            if (document.getElementById(id)) {
                // repeated calls must remove the script tag from the DOM
                scriptElement.remove();
                resolve();
                return false;
            }
            scriptElement.id = id;
            resolve();
        };
    });
};
