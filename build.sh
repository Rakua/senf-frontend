#!/bin/bash
cd "$(dirname "$0")" # cd to directory containing this script (parent of src)
shopt -s globstar

VERBOSE=0
COMPILE_PEGGY=0
COMPILE_TMPL=1

VERSION_LABEL=0.9.0
VERSION_DATE_STR=$(date +"%Y.%m.%d.%H.%M.%S")
VERSION_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# # path to mathjax library to which a sym link is created in dist/
# # if the mathjax library is inserted into src/assets/js set this to ""
# MATHJAX_PATH="../mathjax@3.2.2" 

# update version file
[ "$VERBOSE" -eq 1 ] && echo "Update src/version.ts"
cat <<EOF > src/version.ts
export { version }

const version = {
    label: "$VERSION_LABEL",
    dateStr: "$VERSION_DATE_STR",
    date: new Date("$VERSION_DATE")
}
EOF

# compile post body grammar with peggy (install peggy: npm install -g peggy )
if [ "$COMPILE_PEGGY" -eq 1 ]; then
  [ "$VERBOSE" -eq 1 ] && echo "Peggy start"

  cd  ./src/modules/backend/parser
  npx peggy syntax.pegjs --format es --dts
  if [[ $? -ne 0 ]]; then
      echo "failed to compile syntax grammar"
      exit 1
  fi
  cd ../../../../

  [ "$VERBOSE" -eq 1 ] && echo "Peggy end"
fi

# copy contents of folder src to folder build-tmp
rm -rf build-tmp # clean if it already exists
mkdir build-tmp
cp -a src/. build-tmp/

# assemble and compile templates
if [ "$COMPILE_TMPL" -eq 1 ]; then

  [ "$VERBOSE" -eq 1 ] && echo "Assemble and compile templates"

  cd build-tmp
  cd modules/frontends/default

  dirs=()
  dirs+=("App")
  for d in components/*/ pages/*/; do  
    dirs+=("${d%/}") # remove trailing slash
  done
  # printf "%s\n" "${dirs[@]}"

  mkdir tmpl/App
  mkdir tmpl/pages
  mkdir tmpl/components

  for fullPath in "${dirs[@]}"; do
    relPath="${fullPath#"modules/frontends/default"}"
    # echo "$relPath : $fullPath"

    # replace ./ with $relPath/ in «tpl» tags  
    exts=( "html" "css" )
    for ext in "${exts[@]}"; do    
      tmplFiles=$fullPath/tmpl/**/*.$ext
      if compgen -G $tmplFiles > /dev/null; then
        sed -i "s#«tpl ./#«tpl $relPath/#g" $tmplFiles    
      fi
    done
    
    # copy templates from module to tmpl folder if it exists
    [[ -e "$fullPath/tmpl/." ]] && cp -a "$fullPath/tmpl/." "tmpl/$relPath"      
    rm -rf "$fullPath/tmpl" # remove tmpl folder in module folders
  done

  # compile templates; abort if it fails
  rm tmpl.js
  gts tmpl exts=html,css,txt out=tmpl.js
  if [[ $? -ne 0 ]]; then
      echo "failed to compile templates"
      exit 1
  fi
  rm -rf tmpl

  cd ../../..
  cd ..

  # copy all files from build-tmp to dist & remove *.ts files & tsconfig.json
  rm -rf dist
  cp -a build-tmp/. dist
  find dist -name "*.ts" -type f -delete # remove -delete part for debugging to see which files are deleted
  rm dist/tsconfig.json
  rm -rf build-tmp

  #mv dist/tmpl.js dist/tmpl2.js # store tmpl.js file
  mv dist/modules/frontends/default/tmpl.js dist/modules/frontends/default/tmpl2.js # store tmpl.js file

  [ "$VERBOSE" -eq 1 ] && echo "Finished compiling templates"

fi

# compile typescript files (tsconfig copies js files into respective folder in dist/)
[ "$VERBOSE" -eq 1 ] && echo "TS compile start"
cd src
# tsc --build --verbose
tsc
cd ..
[ "$VERBOSE" -eq 1 ] && echo "TS compile end"

#[ "$COMPILE_TMPL" -eq 1 ] && mv dist/tmpl2.js dist/tmpl.js # restore tmpl.js
[ "$COMPILE_TMPL" -eq 1 ] && mv dist/modules/frontends/default/tmpl2.js dist/modules/frontends/default/tmpl.js # restore tmpl.js

# update preloads with cache buster
[ "$VERBOSE" -eq 1 ] && echo "Update preloads"
php ./compute_preloads.php "$VERSION_DATE_STR"

# set version and date strings in dist/senf.go
sed -i -e "s/\$SF_VERSION/$VERSION_LABEL/" dist/senf.go
sed -i -e "s/\$SF_BUILD_DATE/$VERSION_DATE_STR/" dist/senf.go

# # mathjax sym link
# if [[ -n $MATHJAX_PATH ]]; then
#   [ "$VERBOSE" -eq 1 ] && echo "Create symlink dist/assets/js/mathjax@3.2.2 -> $MATHJAX_PATH"
#   ln -s $MATHJAX_PATH dist/assets/js/mathjax@3.2.2
# fi

echo "V $VERSION_DATE_STR"