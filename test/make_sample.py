"""Builds sample/sample.idml — a small, hand-written IDML used to test Frameplot.
It follows the IDML package layout but was NOT exported from InDesign; for real work use an InDesign export."""
import zipfile, os
PKG='xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"'
HDR='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
def path(x1,y1,x2,y2):
    pts=[(x1,y1),(x1,y2),(x2,y2),(x2,y1)]
    return '<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>'+''.join(
        f'<PathPointType Anchor="{x} {y}" LeftDirection="{x} {y}" RightDirection="{x} {y}"/>' for x,y in pts)+'</PathPointArray></GeometryPathType></PathGeometry></Properties>'
def story(sid,text,style='ParagraphStyle/Body'):
    return HDR+f'<idPkg:Story {PKG} DOMVersion="20.0"><Story Self="{sid}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n"><StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/><ParagraphStyleRange AppliedParagraphStyle="{style}"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>{text}</Content></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>'
def tf(self_,sid,x1,y1,x2,y2,extra=''):
    return f'<TextFrame Self="{self_}" ParentStory="{sid}" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" ItemLayer="u2f" ItemTransform="1 0 0 1 0 0"{extra}>'+path(x1,y1,x2,y2)+'<TextFramePreference TextColumnCount="1"/></TextFrame>'
def rect(self_,x1,y1,x2,y2,fill='Swatch/None',extra='',tr='1 0 0 1 0 0'):
    return f'<Rectangle Self="{self_}" ContentType="GraphicType" ItemLayer="u2f" FillColor="{fill}" StrokeColor="Swatch/None" ItemTransform="{tr}"{extra}>'+path(x1,y1,x2,y2)+'</Rectangle>'
def page(self_,name,b,tr,m):
    return f'<Page Self="{self_}" GeometricBounds="{b}" ItemTransform="{tr}" Name="{name}" AppliedMaster="ub1"><MarginPreference ColumnCount="1" ColumnGutter="12" Top="{m}" Bottom="{m}" Left="{m}" Right="{m}"/></Page>'

spread1=HDR+f'<idPkg:Spread {PKG} DOMVersion="20.0"><Spread Self="u100" PageCount="1" BindingLocation="0" ItemTransform="1 0 0 1 0 0">'+\
 page('u101','1','0 0 792 612','1 0 0 1 0 -396',36)+\
 tf('u110','u1a0',36,-360,576,-300)+tf('u111','u1a1',36,-290,576,-200)+\
 rect('u112',36,-180,576,40,extra=' Name="CHART_1"')+\
 rect('u113',0,350,612,396,fill='Color/Navy')+\
 tf('u114','u1a2',36,60,300,150)+rect('u115',320,60,576,150)+\
 '</Spread></idPkg:Spread>'
spread2=HDR+f'<idPkg:Spread {PKG} DOMVersion="20.0"><Spread Self="u200" PageCount="2" BindingLocation="1" ItemTransform="1 0 0 1 0 0">'+\
 page('u201','2','0 0 792 612','1 0 0 1 -612 -396',36)+page('u202','3','0 0 792 612','1 0 0 1 0 -396',36)+\
 tf('u210','u1a3',-576,-360,-36,-250)+\
 '<Group Self="u211" ItemTransform="1 0 0 1 100 50">'+rect('u212',0,0,200,120,fill='Color/Gold')+'</Group>'+\
 tf('u213','u1a4',36,-360,576,-200)+\
 '</Spread></idPkg:Spread>'
graphic=HDR+f'<idPkg:Graphic {PKG} DOMVersion="20.0">'+\
 '<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" Name="Black"/>'+\
 '<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" Name="Paper"/>'+\
 '<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" Name="Registration"/>'+\
 '<Color Self="Color/Navy" Model="Process" Space="CMYK" ColorValue="100 80 30 20" ColorOverride="Normal" Name="Navy"/>'+\
 '<Color Self="Color/Gold" Model="Process" Space="CMYK" ColorValue="0 25 100 0" ColorOverride="Normal" Name="Gold"/>'+\
 '<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>'+\
 '</idPkg:Graphic>'
styles=HDR+f'<idPkg:Styles {PKG} DOMVersion="20.0"><RootParagraphStyleGroup Self="u7c">'+\
 '<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]"/>'+\
 '<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle"/>'+\
 '<ParagraphStyle Self="ParagraphStyle/Body" Name="Body"/><ParagraphStyle Self="ParagraphStyle/Headline" Name="Headline"/>'+\
 '</RootParagraphStyleGroup></idPkg:Styles>'
fonts=HDR+f'<idPkg:Fonts {PKG} DOMVersion="20.0"><FontFamily Self="FontFamily/Arial" Name="Arial"><Font Self="FontFamily/ArialRegular" FontFamily="Arial" Name="Arial Regular" PostScriptName="ArialMT" Status="Installed" FontStyleName="Regular" FontType="TrueType"/><Font Self="FontFamily/ArialBold" FontFamily="Arial" Name="Arial Bold" PostScriptName="Arial-BoldMT" Status="Installed" FontStyleName="Bold" FontType="TrueType"/></FontFamily></idPkg:Fonts>'
prefs=HDR+f'<idPkg:Preferences {PKG} DOMVersion="20.0"><DocumentPreference PageHeight="792" PageWidth="612" PagesPerDocument="3" FacingPages="true"/></idPkg:Preferences>'
master=HDR+f'<idPkg:MasterSpread {PKG} DOMVersion="20.0"><MasterSpread Self="ub1" Name="A-Master" PageCount="2" ItemTransform="1 0 0 1 0 0"/></idPkg:MasterSpread>'
design=HDR+'<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="20.0(95)" ?>\n'+\
 f'<Document {PKG} DOMVersion="20.0" Self="d" StoryList="u1a0 u1a1 u1a2 u1a3 u1a4" Name="sample.idml" ZeroPoint="0 0" ActiveLayer="u2f">'+\
 '<idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Fonts src="Resources/Fonts.xml"/><idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/>'+\
 '<Layer Self="u2f" Name="Layer 1" Visible="true" Locked="false"><Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>'+\
 '<idPkg:MasterSpread src="MasterSpreads/MasterSpread_ub1.xml"/><idPkg:Spread src="Spreads/Spread_u100.xml"/><idPkg:Spread src="Spreads/Spread_u200.xml"/>'+\
 ''.join(f'<idPkg:Story src="Stories/Story_{s}.xml"/>' for s in ['u1a0','u1a1','u1a2','u1a3','u1a4'])+'</Document>'
os.makedirs('sample',exist_ok=True)
with zipfile.ZipFile('sample/sample.idml','w') as z:
    z.writestr(zipfile.ZipInfo('mimetype'),'application/vnd.adobe.indesign-idml-package',compress_type=zipfile.ZIP_STORED)
    d=lambda n,c:z.writestr(n,c,compress_type=zipfile.ZIP_DEFLATED)
    d('META-INF/container.xml',HDR+'<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>')
    d('designmap.xml',design); d('Resources/Graphic.xml',graphic); d('Resources/Fonts.xml',fonts); d('Resources/Styles.xml',styles); d('Resources/Preferences.xml',prefs)
    d('MasterSpreads/MasterSpread_ub1.xml',master); d('Spreads/Spread_u100.xml',spread1); d('Spreads/Spread_u200.xml',spread2)
    d('Stories/Story_u1a0.xml',story('u1a0','Quarterly Report','ParagraphStyle/Headline'))
    d('Stories/Story_u1a1.xml',story('u1a1','Revenue grew in every region this year. The chart below shows the breakdown by quarter.'))
    d('Stories/Story_u1a2.xml',story('u1a2','Notes: figures are unaudited.'))
    d('Stories/Story_u1a3.xml',story('u1a3','Regional outlook'))
    d('Stories/Story_u1a4.xml',HDR+f'<idPkg:Story {PKG} DOMVersion="20.0"><Story Self="u1a4" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content></Content></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>')
print('wrote sample/sample.idml')
