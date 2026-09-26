#!/bin/sh
# index.html が読み込む css/js の URL に、ファイル内容から計算したバージョン(?v=ハッシュ)を付ける。
# GitHub Pages は各ファイルを10分ほどキャッシュするため、更新のたびにURLが変わるようにして、
# 古いファイルと新しいファイルが混在して動かなくなるのを防ぐ。
cd "$(dirname "$0")/.." || exit 0
HASH=$(cat css/*.css js/*.js | md5sum | cut -c1-8)
sed -E -i "s#((href|src)=\"(css|js)/[^\"?]+)(\?v=[0-9a-f]+)?\"#\1?v=${HASH}\"#g" index.html
