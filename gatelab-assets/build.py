import os, math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

F='node_modules/@fontsource/'
MAN=TTFont(F+'manrope/files/manrope-latin-800-normal.woff')
MAN7=TTFont(F+'manrope/files/manrope-latin-700-normal.woff')
JB=TTFont(F+'jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff')

def text_path(font,s,size,x,y,ls=0.0):
    gs=font.getGlyphSet(); cmap=font.getBestCmap(); upm=font['head'].unitsPerEm
    sc=size/upm; d=[]; cx=x
    for ch in s:
        gn=cmap[ord(ch)]; pen=SVGPathPen(gs,ntos=lambda v:f'{v:.2f}'.rstrip('0').rstrip('.'))
        gs[gn].draw(TransformPen(pen,(sc,0,0,-sc,cx,y)))
        d.append(pen.getCommands()); cx+=gs[gn].width*sc+ls*size
    return ' '.join(d), cx-x-ls*size
def cap_h(font,size): return font['OS/2'].sCapHeight/font['head'].unitsPerEm*size

# palette
P=dict(signal='#65D98A',deep='#163D2B',graphite='#0E1311',panel='#1A231D',text='#E8F0EA',muted='#9BA99F',
       ink_green='#1B7F4A',ink='#101512',err='#FF6B5E',warn='#F2B84B',unk='#B794F6',net='#5AA9FF')

def mark(c,node=None,x=0,y=0,s=1):
    node=node or c
    # viewBox 68x64: AND-style gate body, two inputs converging, output trace threading through the body into a verified node
    return (f'<g transform="translate({x} {y}) scale({s})">'
      f'<path d="M18 12H30A20 20 0 0 1 30 52H18Z" fill="none" stroke="{c}" stroke-width="6" stroke-linejoin="round"/>'
      f'<path d="M4 23H15M4 41H15" fill="none" stroke="{c}" stroke-width="4"/>'
      f'<path d="M33 32H58" fill="none" stroke="{c}" stroke-width="4"/>'
      f'<circle cx="60" cy="32" r="4.5" fill="{node}"/></g>')
def tiny(c,x=0,y=0,s=1):
    # optimised for 16-48px: heavier body, no input stubs, bigger node
    return (f'<g transform="translate({x} {y}) scale({s})">'
      f'<path d="M10 14H26A18 18 0 0 1 26 50H10Z" fill="none" stroke="{c}" stroke-width="8" stroke-linejoin="round"/>'
      f'<circle cx="56" cy="32" r="5.5" fill="{c}"/></g>')

SIZE=50; GAP=15
def word(cg,cl,x,y):
    d1,w1=text_path(MAN,'Gate',SIZE,x,y,-0.015); d2,w2=text_path(MAN,'Lab',SIZE,x+w1-0.015*SIZE*0+SIZE*-0.015,y,-0.015)
    return f'<path d="{d1}" fill="{cg}"/><path d="{d2}" fill="{cl}"/>', w1+w2
def svg(w,h,body,title='GateLab'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}" role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'

capH=cap_h(MAN,SIZE); base=32+capH/2
_,ww=word('','',0,0)
TW=68+GAP+ww
O='out/'; os.makedirs(O+'logo',exist_ok=True); os.makedirs(O+'icons',exist_ok=True)
def W(p,s): open(O+p,'w').write(s)

variants={'dark':(P['signal'],P['text'],P['signal']),'light':(P['ink_green'],P['ink'],P['ink_green']),'mono':('#000','#000','#000'),'mono-white':('#fff','#fff','#fff')}
for k,(m,g,l) in variants.items():
    wb,_=word(g,l,68+GAP,base)
    W(f'logo/gatelab-logo-{k}.svg',svg(TW,64,mark(m)+wb,'GateLab'))
    W(f'logo/gatelab-symbol-{k}.svg',svg(68,64,mark(m),'GateLab symbol'))
    wb2,_=word(g,l,0,base+ (0)); 
    W(f'logo/gatelab-wordmark-{k}.svg',svg(ww,64,word(g,l,0,base)[0],'GateLab'))
# primary = native dark-surface version
import shutil
shutil.copy(O+'logo/gatelab-logo-dark.svg',O+'logo/gatelab-logo.svg')
shutil.copy(O+'logo/gatelab-symbol-dark.svg',O+'logo/gatelab-symbol.svg')
shutil.copy(O+'logo/gatelab-wordmark-dark.svg',O+'logo/gatelab-wordmark.svg')

# favicon svg (rounded tile, tiny mark) -- tile uses graphite so green reads on light & dark tabs
def tile(bgc,fg,mk,r,size=64):
    return f'<rect width="{size}" height="{size}" rx="{r}" fill="{bgc}"/>'
fav=svg(64,64,tile(P['graphite'],'',0,14)+tiny(P['signal'],0.5,0,1),'GateLab')
W('icons/icon.svg',fav)
W('icons/favicon.svg',fav)

# app icons (full-bleed bg, mark with inputs), safe padding; maskable has larger padding
def appicon(sz,pad_frac,use_tiny=False,rounded=False):
    mw=68; inner=sz*(1-2*pad_frac); s=inner/mw
    mh=64*s; x=(sz-68*s)/2; y=(sz-mh)/2
    m=tiny(P['signal'],x,y,s) if use_tiny else mark(P['signal'],None,x,y,s)
    bg=f'<rect width="{sz}" height="{sz}" rx="{sz*0.22 if rounded else 0}" fill="{P["graphite"]}"/>'
    return svg(sz,sz,bg+m)
W('icons/_apple.svg',appicon(180,0.2)); W('icons/_192.svg',appicon(192,0.2,rounded=False))
W('icons/_512.svg',appicon(512,0.2)); W('icons/_512m.svg',appicon(512,0.3))
W('icons/_16.svg',svg(16,16,tile(P['graphite'],'',0,3.5,16)+tiny(P['signal'],0.12,0,0.25),'')) 
W('icons/_32.svg',svg(32,32,tile(P['graphite'],'',0,7,32)+tiny(P['signal'],0.25,0,0.5),''))
W('icons/_48.svg',svg(48,48,tile(P['graphite'],'',0,10,48)+tiny(P['signal'],0.4,0,0.75),''))

# ---------- Open Graph 1200x630
def card_text(s,size,x,y,font=MAN,c=P['text'],ls=0):
    d,w=text_path(font,s,size,x,y,ls); return f'<path d="{d}" fill="{c}"/>',w
og=[f'<rect width="1200" height="630" fill="{P["graphite"]}"/>',
    f'<rect x="0" y="0" width="1200" height="630" fill="url(#g)"/>']
defs=f'<defs><radialGradient id="g" cx="0.82" cy="0.35" r="0.7"><stop offset="0" stop-color="{P["deep"]}" stop-opacity="0.75"/><stop offset="1" stop-color="{P["graphite"]}" stop-opacity="0"/></radialGradient></defs>'
# logo
wb,_=word(P['text'],P['signal'],68*1.0+GAP,base)
og.append(f'<g transform="translate(72 64) scale(0.9)">{mark(P["signal"])}{wb}</g>')
l1,_=card_text('Boolean algebra,',66,72,306); l2,w2=card_text('wired up.',66,72,382,c=P['signal'])
og+= [l1,l2]
sub,_=card_text('Minimize it. Wire it. Prove it matches.',30,72,444,font=MAN7,c=P['muted']); og.append(sub)
# stage chips
x=72
for i,t in enumerate(['THEORY','DIAGRAM','LAB','REPORT']):
    d,w=text_path(JB,t,19,0,0,0.06)
    cw=w+44
    og.append(f'<rect x="{x}" y="520" width="{cw:.0f}" height="44" rx="10" fill="{P["panel"]}" stroke="#2A372E"/>')
    og.append(f'<text/>' if False else '')
    og.append(f'<g transform="translate({x+22} 548)"><path d="{d}" fill="{P["text"]}"/></g>')
    og.append(f'<circle cx="{x+14}" cy="542" r="0" />')
    x+=cw+12
# verification panel
px,py,pw,ph=690,150,438,330
og.append(f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="18" fill="{P["panel"]}" stroke="#2A372E" stroke-width="1.5"/>')
def mono(s,size,x,y,c): d,w=text_path(JB,s,size,x,y); return f'<path d="{d}" fill="{c}"/>'
og.append(mono('DERIVED',17,px+32,py+54,P['muted'])); og.append(mono("F = A·B' + B·C",30,px+32,py+96,P['text']))
og.append(f'<path d="M{px+32} {py+124}H{px+pw-32}" stroke="#2A372E" stroke-width="1.5"/>')
og.append(mono('BUILT',17,px+32,py+162,P['muted'])); og.append(mono('7408 + 7432 + 7404',30,px+32,py+204,P['text']))
og.append(f'<path d="M{px+32} {py+232}H{px+pw-32}" stroke="#2A372E" stroke-width="1.5"/>')
og.append(mono('CHECKED',17,px+32,py+270,P['muted']))
og.append(f'<circle cx="{px+46}" cy="{py+292}" r="15" fill="{P["signal"]}"/><path d="M{px+38} {py+292}l5.5 6 10-12" fill="none" stroke="{P["graphite"]}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>')
og.append(mono('8 of 8 rows agree',30,px+72,py+303,P['signal']))
W('og.svg',svg(1200,630,defs+''.join(og)))
print('TW',TW,'ww',ww)

# contrast
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c:c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return .2126*f(r)+.7152*f(g)+.0722*f(b)
def cr(a,b): la,lb=sorted([lum(a),lum(b)],reverse=True); return (la+.05)/(lb+.05)
for a,b in [(P['signal'],P['graphite']),(P['text'],P['graphite']),(P['muted'],P['panel']),(P['ink_green'],'#FFFFFF'),(P['ink'],'#FFFFFF'),(P['graphite'],P['signal'])]:
    print(a,b,round(cr(a,b),2))
