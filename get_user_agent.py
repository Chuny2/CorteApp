import randomuagents

def get_random_user_agent(device_type=""):
    ua_instance = randomuagents.UA(device_type)
    random_ua = ua_instance._uGet()
    return random_ua

if __name__ == "__main__":
    print(get_random_user_agent("mobile"))  
