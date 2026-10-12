export function nodeCommand(executable = process.execPath, platform = process.platform) {
  if (platform !== "darwin") return executable;
  return executable.replace(
    /^(\/opt\/homebrew|\/usr\/local)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/,
    "$1/opt/$2/bin/node",
  );
}
