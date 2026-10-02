import base64, json, os, sys, urllib.request, concurrent.futures as cf
env = dict(l.split('=',1) for l in open('/Users/jordanquiqueret/Works/Websites/the_game/.env').read().splitlines() if l.startswith('OPENAI'))
KEY = env['OPENAI_API_KEY'].strip().strip('"').strip("'")
D, S, A = '#0b0f1c', '#46536e', '#ff2e88'
STYLE = f"""Drawn in the DARK DECO style of the 1990s Batman animated series crossed with the flat polygonal backdrops of the 1992 video game Flashback: painted as if on black paper, retro-futurist megastructure of stepped towers, bold angular geometry, strong verticals, flat cel-shaded shapes with hard edges, no gradients, no texture, heavy black shadows swallowing whole areas, powerful silhouettes, film-noir lighting from a single source.

STRICT THREE-COLOR PALETTE, nothing else: {D} (near-black ink blue) about 70 percent, the shadow; {S} (steel blue-grey) about 20 percent, surfaces catching indirect light; {A} (hot neon magenta) about 10 percent, the ONLY light, painted as LARGE SOLID SHAPES: neon tubes, screens, hard-edged shafts and pools of light on wet surfaces. Everything the light touches is {A}, everything else is shadow.

Neon rendered as abstract glowing tubes and geometric glyphs, never readable letters. No text, no lettering, no numbers, no logo, no watermark anywhere. Not photorealistic, not 3d, not anime, not medieval."""
SUBJECTS = {
 'avatar': "Square emblem composition, everything centered so it survives a circular crop: a single towering stepped ziggurat spire seen from street level, perfectly symmetrical, its central needle outlined by a vertical neon tube, rain falling in straight hard lines, a tiny lone silhouette in a long coat and brimmed hat standing at its foot, looking up. Large empty dark sky around it.",
 '1-la-ville': "Square composition. View down a rain-soaked canyon of colossal stepped towers at night, endless verticals vanishing upward, a narrow footbridge crossing the void in the middle ground with one lone figure in a long coat walking across it, neon tubes running down the tower edges, a flying car silhouette between buildings, rain in straight hard streaks, the street far below glowing.",
 '2-l-oeil': "Square composition, face centered. Close-up bust portrait in profile three-quarter view of an anonymous city dweller with a hard angular jaw, collar turned up, half the face swallowed by solid black shadow, one bionic eye implant glowing as a solid neon disc with concentric geometric rings, thin cable implants at the temple suggested by flat shapes, rain streaks on the window glass behind, blurred-free flat city lights behind as geometric blocks.",
 '3-le-sas': "Square composition. A massive armored blast door at the end of a wet concrete corridor, its frame built of stepped concentric layers, closed, a single card reader beside it glowing as a solid neon slot, a gloved hand in the foreground raising a blank access card toward it, pools of neon light on the wet floor, heavy pipes and cable bundles on the walls, deep perspective.",
 '4-insomnie': "Square composition. Inside a tiny bare apartment at three in the morning, a figure sitting awake on the edge of a narrow bed, seen from behind as a black silhouette, facing a tall window; outside, a wall of giant lit advertising screens and neon tubes on the facing tower floods the room with hard-edged shafts of neon light that cut the floor and the walls. The city never sleeps. Melancholic, quiet, lonely.",
}
def gen(name):
    size = '1024x1024'  # carré pour Instagram
    body = json.dumps({'model':'gpt-image-2','prompt':SUBJECTS[name]+'\n\n'+STYLE,'size':size,'quality':'high','n':1,'output_format':'png'}).encode()
    req = urllib.request.Request('https://api.openai.com/v1/images/generations', body, {'Authorization':'Bearer '+KEY,'Content-Type':'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=600))
    except urllib.error.HTTPError as e:
        return name, 'ERR '+e.read().decode()[:400]
    open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'carre', f'{name}.png'),'wb').write(base64.b64decode(r['data'][0]['b64_json']))
    return name, 'ok'
names = sys.argv[1:] or list(SUBJECTS)
with cf.ThreadPoolExecutor(5) as ex:
    for n, s in ex.map(gen, names): print(n, s, flush=True)
