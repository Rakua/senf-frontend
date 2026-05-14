<?php

$vds = "";
if(isset($arv[1])) {
    $vds = $argv[1];
}

$directory = 'dist';

// Make sure the directory exists
if (!is_dir($directory)) {
    die("Directory '$directory' not found.");
}

// Use RecursiveIteratorIterator and RecursiveDirectoryIterator to find .js files
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($directory)
);

$preloads = "";

foreach ($iterator as $file) {
    if ($file->isFile() && pathinfo($file, PATHINFO_EXTENSION) === 'js') {
        // Get the file path relative to the dist directory
        $relativePath = str_replace('\\', '/', substr($file->getPathname(), strlen($directory) + 1));
        if(str_starts_with($relativePath,"modules/libs/highlight/languages")) continue;
        
        // $preloads .= '<link rel="modulepreload" href="' . htmlspecialchars($relativePath, ENT_QUOTES) . "?vds=".$argv[1]."\" />\n";
        $preloads .= '<link rel="modulepreload" href="' . htmlspecialchars($relativePath, ENT_QUOTES) ."\" />\n";
    }
}

$preloads = "\n".$preloads;
replaceBetweenTokens("dist/index.html","<!-- #PRELOADS_START -->","<!-- #PRELOADS_END -->",$preloads);

function replaceBetweenTokens($filePath, $startToken, $endToken, $newContent) {
    if (!file_exists($filePath)) {
        throw new Exception("File not found: $filePath");
    }

    $content = file_get_contents($filePath);

    $startPos = strpos($content, $startToken);
    $endPos   = strpos($content, $endToken);

    if ($startPos === false || $endPos === false || $endPos <= $startPos) {
        throw new Exception("Tokens not found or invalid order");
    }

    // Move start position to end of start token
    $startPos += strlen($startToken);

    // Build new content
    $updated =
        substr($content, 0, $startPos) .
        $newContent .
        substr($content, $endPos);

    return file_put_contents($filePath, $updated) !== false;
}

?>
