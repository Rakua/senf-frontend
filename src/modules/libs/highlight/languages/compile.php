<?php
$dir = "min/";
$ext = ".min.js";

$token_def = "var hljsGrammar=";
$token_export = "export default hljsGrammar;";
$out_start = <<<'EOD'
export { };
import hljs from "./highlight.js";
var hljsGrammar;

EOD;

$files = glob($dir."*");

print $out_start;
foreach ($files as $file) {
    if (!is_file($file)) continue;
    $lang = substr($file,strlen($dir),-1*strlen($ext));
    //echo "Language: {$lang}\n";
    $c = file_get_contents($file);
    if(strpos($c,$token_def) == false) {
        die("failed to find '".$token_def."' in ".$file);
    }
    if(strpos($c,$token_export) == false) {
        die("failed to find '".$token_export."' in ".$file);
    }    

    //remove export statement
    $c = str_replace($token_export,"",$c);
    
    //replace
    $c = str_replace($token_def,"hljsGrammar=",$c);
    print $c."\n";
    print "hljs.registerLanguage('".$lang."',hljsGrammar);\n";
    //print "console.log('registering language ".$lang."');\n";
}

?> 
