package com.khumphringfa.cricboard;

import android.app.Activity;
import android.accounts.Account;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.webkit.*;
import android.widget.Toast;
import androidx.credentials.*;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.webkit.*;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class MainActivity extends Activity {
    private static final String HOST="cricboard.manas-tripura.workers.dev", ORIGIN="https://"+HOST;
    private static final String CLIENT="342863663518-8raaefvf2qt3skk5jfbego0vfob8441f.apps.googleusercontent.com";
    private static final Set<String> ASSETS=new HashSet<>(Arrays.asList("index.html","styles.css","public.css","favicon.svg","app.js","account.mjs","engine.mjs","cloud.mjs","central.mjs","portal.mjs","public-data.mjs","native.js","peerjs.min.js"));
    private WebView web;
    private ValueCallback<Uri[]> picker;
    private JavaScriptReplyProxy driveReply, saveReply;
    private String driveId, saveId, saveContent;
    private boolean authBusy;
    private static final int DRIVE=101, SAVE=102, PICK=103;
    private boolean trusted(Uri u){return "https".equals(u.getScheme())&&HOST.equals(u.getHost())&&u.getPort()==-1&&u.getUserInfo()==null;}
    private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);web=new WebView(this);setContentView(web);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !trusted(r.getUrl())||!r.isForMainFrame();}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                Uri u=r.getUrl();if(trusted(u)){
                    String path=u.getPath();if(path==null)return blocked();if(path.startsWith("/api/")&&!r.isForMainFrame())return null;
                    String name=path.equals("/")?"index.html":path.substring(1);
                    if(!"GET".equals(r.getMethod())||!ASSETS.contains(name))return blocked();
                    try{String mime=name.endsWith(".html")?"text/html":name.endsWith(".css")?"text/css":name.endsWith(".svg")?"image/svg+xml":"text/javascript";
                        Map<String,String> headers=new HashMap<>();
                        headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: https://www.googleapis.com https://peerjs.com https://*.peerjs.com wss://*.peerjs.com; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
                        headers.put("Cache-Control","no-store");return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open(name));
                    }catch(IOException e){return blocked();}
                }
                if(!r.isForMainFrame()&&"https".equals(u.getScheme())&&("www.googleapis.com".equals(u.getHost())||"peerjs.com".equals(u.getHost())||"0.peerjs.com".equals(u.getHost())))return null;
                return blocked();
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams params){
                if(picker!=null)picker.onReceiveValue(null);picker=cb;
                try{startActivityForResult(params.createIntent(),PICK);}catch(Exception e){picker.onReceiveValue(null);picker=null;}return true;
            }
        });
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            Toast.makeText(this,"Update Android System WebView to use CricBoard",Toast.LENGTH_LONG).show();return;
        }
        WebViewCompat.addWebMessageListener(web,"CricAndroid",Collections.singleton(ORIGIN),(v,msg,origin,main,reply)->{
            if(!main||!trusted(origin)||msg.getData()==null)return;
            try{JSONObject data=new JSONObject(msg.getData());String id=data.getString("id");
                switch(data.getString("action")){
                    case "signIn": signIn(reply,id);break;
                    case "drive": authorizeDrive(reply,id,data.optBoolean("interactive"),data.optString("email"));break;
                    case "signOut": CookieManager.getInstance().removeAllCookies(ok->{CookieManager.getInstance().flush();respond(reply,id,true,null);});break;
                    case "save": save(reply,id,data.optString("filename"),data.optString("content"));break;
                    default: respond(reply,id,null,"Unknown request");
                }
            }catch(Exception e){Toast.makeText(this,"Invalid app request",Toast.LENGTH_SHORT).show();}
        });
        web.loadUrl(ORIGIN+"/?manage=1");
    }
    private void respond(JavaScriptReplyProxy reply,String id,Object value,String error){try{JSONObject result=new JSONObject();result.put("id",id);result.put("value",value==null?JSONObject.NULL:value);if(error!=null)result.put("error",error);reply.postMessage(result.toString());}catch(Exception ignored){}}
    private void signIn(JavaScriptReplyProxy reply,String id){
        if(authBusy){respond(reply,id,null,"Google account dialog is already open");return;}authBusy=true;
        try{
            GetSignInWithGoogleOption option=new GetSignInWithGoogleOption.Builder(CLIENT).build();
            GetCredentialRequest request=new GetCredentialRequest.Builder().addCredentialOption(option).build();
            CredentialManager.create(this).getCredentialAsync(this,request,new CancellationSignal(),getMainExecutor(),new CredentialManagerCallback<GetCredentialResponse,GetCredentialException>(){
                @Override public void onResult(GetCredentialResponse result){authBusy=false;try{String token=GoogleIdTokenCredential.createFrom(result.getCredential().getData()).getIdToken();respond(reply,id,token,null);}catch(Exception e){respond(reply,id,null,"Google credential was not valid");}}
                @Override public void onError(GetCredentialException e){authBusy=false;respond(reply,id,null,"Google sign-in failed or was cancelled. Verify Android OAuth configuration.");}
            });
        }catch(Exception e){authBusy=false;respond(reply,id,null,"Google sign-in could not start");}
    }
    private void authorizeDrive(JavaScriptReplyProxy reply,String id,boolean interactive,String email){
        if(authBusy||driveReply!=null){respond(reply,id,null,"Google authorization already in progress");return;}
        if(!email.contains("@")){respond(reply,id,null,"Sign in first");return;}authBusy=true;
        try{AuthorizationRequest request=AuthorizationRequest.builder().setAccount(new Account(email,"com.google")).setRequestedScopes(Arrays.asList(new Scope("https://www.googleapis.com/auth/drive.appdata"),new Scope("openid"),new Scope("https://www.googleapis.com/auth/userinfo.email"),new Scope("https://www.googleapis.com/auth/userinfo.profile"))).build();
            Identity.getAuthorizationClient(this).authorize(request).addOnSuccessListener(result->{
                authBusy=false;
                if(result.hasResolution()){
                    if(!interactive){respond(reply,id,null,"Reconnect Google Drive to authorize backup");return;}
                    driveReply=reply;driveId=id;
                    try{startIntentSenderForResult(result.getPendingIntent().getIntentSender(),DRIVE,null,0,0,0);}catch(Exception e){driveReply=null;respond(reply,id,null,"Could not open authorization");}
                }else respond(reply,id,result.getAccessToken(),result.getAccessToken()==null?"Drive authorization unavailable":null);
            }).addOnFailureListener(e->{authBusy=false;respond(reply,id,null,"Drive authorization failed. Verify Android OAuth configuration.");});
        }catch(Exception e){authBusy=false;respond(reply,id,null,"Drive authorization could not start");}
    }
    private void save(JavaScriptReplyProxy reply,String id,String filename,String content){
        if(saveReply!=null||content.length()>5000000){respond(reply,id,null,"Export unavailable or too large");return;}
        saveReply=reply;saveId=id;saveContent=content;
        Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(filename.endsWith(".csv")?"text/csv":"application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,filename.replaceAll("[^A-Za-z0-9._-]","_"));
        try{startActivityForResult(i,SAVE);}catch(Exception e){saveReply=null;saveContent=null;respond(reply,id,null,"No file picker available");}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request==DRIVE&&driveReply!=null){JavaScriptReplyProxy reply=driveReply;String id=driveId;driveReply=null;try{if(result!=RESULT_OK)throw new Exception();AuthorizationResult a=Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);respond(reply,id,a.getAccessToken(),a.getAccessToken()==null?"Drive token unavailable":null);}catch(Exception e){respond(reply,id,null,"Drive permission not granted");}}
        if(request==SAVE&&saveReply!=null){JavaScriptReplyProxy reply=saveReply;String id=saveId;saveReply=null;try{if(result!=RESULT_OK||data==null)throw new IOException();try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out==null)throw new IOException();out.write(saveContent.getBytes(StandardCharsets.UTF_8));}respond(reply,id,true,null);}catch(Exception e){respond(reply,id,null,"Export cancelled or failed");}finally{saveContent=null;}}
        if(request==PICK&&picker!=null){picker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));picker=null;}
    }
    @Override protected void onPause(){super.onPause();CookieManager.getInstance().flush();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.evaluateJavascript("if(navigator.onLine)window.dispatchEvent(new Event('online'))",null);}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
}
